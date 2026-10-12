import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordsService, SessionsService } from './passwords.service';
import { TokensService } from './tokens.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { UsersModule } from '../users/users.module';
import { AppConfig } from '../config/configuration';

@Global()
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('jwtSecret', { infer: true }),
        signOptions: {
          expiresIn: config.get('accessTtlSeconds', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordsService,
    SessionsService,
    TokensService,
    AdminBootstrapService,
  ],
  exports: [
    AuthService,
    PasswordsService,
    TokensService,
    SessionsService,
    JwtModule,
  ],
})
export class AuthModule {}
