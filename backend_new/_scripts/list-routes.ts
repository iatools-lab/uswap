import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  const paths = Object.keys(doc.paths ?? {}).sort();
  console.log('=== ROUTES BACKEND (Swagger) : ' + paths.length + ' ===');
  for (const p of paths) {
    const verbs = Object.keys((doc.paths as Record<string, object>)[p]).map((v) => v.toUpperCase()).join(',');
    console.log(`  ${verbs.padEnd(16)} ${p}`);
  }
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
