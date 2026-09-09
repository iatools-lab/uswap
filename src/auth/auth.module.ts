import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';

const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 900;

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: `${ACCESS_TOKEN_TTL_SECONDS}s` },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailService, JwtStrategy, RolesGuard],
  exports: [AuthService],
})
export class AuthModule {}