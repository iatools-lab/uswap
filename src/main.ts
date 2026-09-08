import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
  }

  const app = await NestFactory.create(AppModule);
  const corsOrigin = process.env.CORS_ORIGIN;

  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((origin) => origin.trim()) : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Uswap API')
    .setDescription('API de planification et suivi des équipes de swapping')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  await app.listen(Number(process.env.PORT) || 3000);
}

void bootstrap();
