import { Controller, Get } from '@nestjs/common';

import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { UsersService } from './users.service';

/**
 * Pre-authentication directory backing the login screen's profile picker.
 *
 * Deliberately NOT behind JwtAuthGuard — the user is not logged in yet. It
 * therefore exposes only what a visitor may see: who exists and at which
 * station, never credentials, contact details or account state.
 */
@ApiTags('users')
@Controller('public')
export class PublicUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profiles')
  @ApiOperation({
    summary: 'Comptes actifs proposables sur l ecran de connexion (public)',
  })
  findProfiles() {
    return this.usersService.findProfiles();
  }
}
