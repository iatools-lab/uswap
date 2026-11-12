import { ModulesContainer, NestFactory, Reflector } from '@nestjs/core';
import {
  ValidationPipe,
  Logger,
  ClassSerializerInterceptor,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfig } from './config/configuration';
import {
  CONTROLLER_SPACES,
  ensurePathList,
  readScopedList,
} from './common/routing/role-route';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { RouterMethodFactory } from '@nestjs/core/helpers/router-method-factory';

/**
 * Réapplique les préfixes d'espace des contrôleurs migrés.
 *
 * TypeScript applique `@Controller(...)` EN DERNIER : il écrase la métadonnée
 * du contrôleur par la seule chaîne du nom métier (`users`, `/`…), et les
 * routes `/pilot/...`, `/superadmin/...` n'étaient alors pas déclarées du tout.
 * La liste canonique, conservée sous sa propre clé par nos décorateurs (voir
 * `common/routing/role-route.ts`), est donc réécrite ici, avant que Nest ne
 * parcoure les modules.
 */
function restoreRoutePaths(app: INestApplication): void {
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const metatype = wrapper.metatype as object;
      if (metatype) ensurePathList(metatype);
    }
  }
}

/**
 * Ajoute les routes d'espace des contrôleurs À PLAT (`@Controller()`).
 *
 * Pour eux, le nom métier ne peut pas devenir un préfixe de contrôleur : les
 * méthodes portent déjà le chemin complet (`/reports/dashboard`,
 * `/admin/settings`). Leur frontière « un préfixe pour toutes les méthodes » ne
 * convient donc pas ; Nest n'enregistre que le premier préfixe de la liste, et
 * `/superadmin/reports/dashboard` n'existait pas.
 *
 * Chaque handler est réenregistré sous `/superadmin/<chemin>` avec le MÊME
 * proxy que Nest (instance, méthode, module, verbe HTTP) : les gardes globales
 * et le filtre d'exceptions s'appliquent donc à l'identique, et
 * `RoleRouteAccessGuard` vérifie l'appartenance au contrôleur dans l'espace.
 */
/**
 * Contrôleurs à plat (`@Controller()` + chemins complets dans les méthodes)
 * exposés aussi dans l'espace super administrateur.
 *
 * Dérivé de `CONTROLLER_SPACES.superadmin` : une seule source de vérité, donc
 * aucun risque d'oublier un contrôleur dans l'une des deux listes. Le filtre
 * ci-dessous écarte en plus tout contrôleur préfixé (il a déjà son
 * `@SuperAdminRoute`).
 */
const FLAT_SUPER_ADMIN_CONTROLLERS: string[] = CONTROLLER_SPACES.superadmin;

function registerFlatSuperAdminRoutes(app: INestApplication): boolean {
  type ModuleRef = {
    controllers: Map<
      string,
      { name: string; instance: object; metatype: object }
    >;
  };
  type RouteLayer = {
    route: {
      path: string;
      stack: { method: string; handle: (...args: never[]) => unknown }[];
    };
  };
  const server = app.getHttpAdapter().getInstance() as {
    router?: { stack: RouteLayer[] };
  };
  const stack = server.router?.stack;
  if (!stack) return false;

  const controllers = new Map<
    string,
    ModuleRef['controllers'] extends Map<string, infer T> ? T : never
  >();
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      controllers.set(wrapper.name, wrapper as never);
    }
  }

  const factory = new RouterMethodFactory();
  const extras: RouteLayer[] = [];
  /** URL déjà réexposées sur ce passage (évite les doublons). */
  const extraDone = new Set<string>();
  for (const layer of stack) {
    if (!layer.route) continue;
    const handlers = layer.route.stack.filter(
      (entry) => entry.method !== 'use',
    );
    for (const entry of handlers) {
      const proc = (entry.handle as unknown as { callback?: object }).callback;
      if (!proc) continue;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, proc) as
        RequestMethod | undefined;
      const rawPath = Reflect.getMetadata(PATH_METADATA, proc) as
        string | string[] | undefined;
      if (requestMethod === undefined) continue;
      /*
       * SÉLECTION, pas duplication.
       *
       * Un handler peut déclarer plusieurs chemins (`@Get(['leaves/pending',
       * 'admin/leaves/pending'])`) : c'est une liste de compatibilité au sein
       * d'un espace. Sous `/superadmin`, on n'en réexpose QU'UN — les ajouter
       * tous produisait des URL mortes (`/superadmin/admin/reports/...`).
       */
      const allPaths = (
        rawPath === undefined ? [] : Array.isArray(rawPath) ? rawPath : [rawPath]
      ).map((p) => p.replace(/^\/+/, ''));
      const owner = [...controllers.values()].find((wrapper) => {
        // `metatype` n'est pas typé par Nest : on passe par `unknown` pour
        // accéder au prototype sans casser la compilation (`strict`).
        const prototype = (
          wrapper.metatype as unknown as { prototype?: object }
        ).prototype;
        if (!prototype) return false;
        return Object.getOwnPropertyNames(prototype).some(
          (key) => (prototype as Record<string, unknown>)[key] === proc,
        );
      });
      if (!owner) continue;
      /*
       * Contrôleur éligible aux routes `/superadmin/...`.
       *
       * 1. DÉCLARÉ dans l'espace (`@SuperAdminRoute`), ou simplement inscrit
       *    dans `CONTROLLER_SPACES.superadmin`.
       *
       * 2. À PLAT (`@Controller()` + chemins complets dans les méthodes). Pour
       *    eux, `readScopedList` vaut `[]` : `@Controller()` a écrasé la liste
       *    et nos proxys n'appellent pas `ensurePathList` ; elle n'est rétablie
       *    que par `restoreRoutePaths`, APRÈS la construction de la pile. C'est
       *    pourquoi la source de vérité est le NOM du contrôleur (déjà utilisé
       *    par `CONTROLLER_SPACES`).
       *
       * La condition `scopes.includes('superadmin')` seule n'est PAS suffisante :
       * `ReportsController` la remplit, mais Nest n'honore que le premier
       * préfixe de la liste, et `/superadmin/reports/dashboard` (appelé par le
       * tableau de bord) restait en 404 — constaté le 2026-10-31.
       */
      const scopes = readScopedList(owner.metatype);
      const eligible =
        scopes.includes('superadmin') ||
        FLAT_SUPER_ADMIN_CONTROLLERS.includes(owner.name);
      if (!eligible) continue;
      /*
       * Formes exposées sous `/superadmin` : TOUTES celles déclarées par le
       * handler.
       *
       * Nest ne monte que `allPaths[0]` d'un `@Get(['a','b'])` ; les autres
       * formes (compatibilité, ou chemin historique `admin/...`) n'existaient
       * donc pas sous l'espace et répondaient 404. On les réexpose avec le
       * MÊME handler, sauf celle que Nest a déjà montée.
       */
      const targets = new Set<string>(allPaths);
      /*
       * Un handler à plat déclare `''` alors que ses méthodes portent déjà le
       * préfixe historique (`admin/settings`, `super-admin/cleanup`). La forme
       * `''` signifie « racine du contrôleur » : elle n'est valable que sur
       * `/pilot/admin`, jamais sous `/superadmin`, où elle produisait
       * `/superadmin/admin` (page racine inexistante). On la retire donc.
       */
      targets.delete('');
      /*
       * Les formes de compatibilité (`admin/...`, `super-admin/...`) ne sont
       * réexposées que pour les contrôleurs À PLAT (AdminController,
       * DataCleanupController) : leurs méthodes portent déjà leur préfixe
       * historique et `allPaths` y vaut `[]`. Pour un contrôleur de module
       * (`@Controller('users')`), les ajouter produisait des URL mortes et
       * redondantes (`/pilot/reports/reports/dashboard`,
       * `/superadmin/admin/reports/...`). On ne complète donc QUE les listes
       * vides : un handler qui déclare un chemin n'est jamais dupliqué.
       */
      if (targets.size === 0) {
        const declared = Reflect.getOwnMetadata(PATH_METADATA, proc);
        for (const p of Array.isArray(declared) ? declared : [declared]) {
          if (typeof p === 'string') targets.add(p.replace(/^\/+/, ''));
        }
      }
      const verb = factory
        .get(server as never, requestMethod)
        .bind(server) as (path: string, handler: unknown) => void;
      for (const path of targets) {
        const full = `superadmin/${path}`;
        /*
         * Deux protections distinctes :
         *  - ne pas recréer l'URL que Nest a déjà montée (`allPaths[0]`) ;
         *  - ne pas dupliquer une forme déjà réexposée sur cet handler.
         * Le test porte sur l'URL COMPLÈTE : comparer les chemins relatifs
         * écartait à tort les alias (`admin/leaves/pending`).
         */
        if (extraDone.has(full)) continue;
        extraDone.add(full);
        // Même handler que Nest : gardes globales, pipe de validation et
        // filtre d'exceptions s'appliquent à l'identique.
        verb(full, entry.handle);
        extras.push(layer);
      }
    }
  }
  void extras;
  return true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<AppConfig, true>);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('');
  // Avant `app.init()` (déclenché par `listen`) : les préfixes d'espace sont
  // relus par Nest à ce moment-là, une seule fois.
  restoreRoutePaths(app);
  // Après `init()` (la pile de routage n'existe qu'une fois les contrôleurs
  // montés) : ajoute `/superadmin/<chemin>` pour les contrôleurs à plat.
  // Contrôlé : un échec reste visible dans les journaux au lieu de produire
  // silencieusement des 404 côté super administrateur.
  /*
   * IMPORTANT — ordre des middlewares.
   *
   * `app.use(...)` empile le middleware APRÈS les routes déjà montées par
   * `app.init()` : placé après, `cookieParser` ne s'exécutait jamais sur les
   * routes du routeur, `req.cookies` restait `undefined` et
   * `readRefreshCookie()` renvoyait toujours `null`. Conséquence observée :
   * la connexion réussissait (200), puis le premier `/auth/refresh` répondait
   * 401 et la session était effacée — l'utilisateur restait bloqué sur la
   * page de connexion. Les middlewares sont donc posés AVANT `init()`.
   */
  app.use(cookieParser());
  app.use(
    helmet({
      // L'API sert aussi des fichiers telecharges au navigateur du frontend.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  app.enableCors({
    origin: config.get('corsOrigins', { infer: true }),
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  await app.init();
  if (!registerFlatSuperAdminRoutes(app)) {
    logger.warn(
      'Routes /superadmin des contrôleurs à plat NON ajoutées (pile de routage introuvable).',
    );
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const swagger = new DocumentBuilder()
    .setTitle('uSwap API')
    .setDescription(
      'API de gestion des stations et des equipes uSwap. Le contrat reprend ' +
        'celles attendues par frontend : chaque reponse est interchangeable ' +
        'avec la maquette cliente.',
    )
    .setVersion('6.0.0')
    .addCookieAuth('uswap_refresh')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = config.get('port', { infer: true });
  // `listen` sur une application déjà initialisée réutilise la même instance.
  /*
   * Écoute explicite sur toutes les interfaces (`0.0.0.0`). Sans cette valeur,
   * Node résout `localhost` et peut s'attacher à `::1` seulement : un client
   * qui vise `127.0.0.1` reçoit alors ECONNREFUSED, alors que le serveur est
   * démarré (constaté le 2026-11-04 ; même piège que le proxy Vite côté
   * frontend). En conteneur, `0.0.0.0` est de toute façon requis.
   */
  await app.listen(port, '0.0.0.0');
  logger.log(`API uSwap disponible sur http://localhost:${port} (docs: /docs)`);
}

void bootstrap();
