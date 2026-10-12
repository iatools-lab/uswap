import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<AppConfig, true>);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('');
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
        'celles attendues par frontend_new : chaque reponse est interchangeable ' +
        'avec la maquette cliente.',
    )
    .setVersion('6.0.0')
    .addCookieAuth('uswap_refresh')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = config.get('port', { infer: true });
  await app.listen(port);
  logger.log(`API uSwap disponible sur http://localhost:${port} (docs: /docs)`);
}

void bootstrap();
