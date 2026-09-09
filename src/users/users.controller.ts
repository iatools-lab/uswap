import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Get()
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: { user: { id: string } }) {
    return this.usersService.update(id, dto, req.user.id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.usersService.deactivate(id, req.user.id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.usersService.reactivate(id, req.user.id);
  }

  @Roles(Role.ADMIN)
  @Post(':id/resend-invitation')
  resendInvitation(@Param('id') id: string) {
    return this.usersService.resendInvitation(id);
  }

  @Roles(Role.ADMIN)
  @Get('import/template')
  downloadTemplate(@Res() res: Response) {
    const csv = this.usersService.generateTemplate();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="modele_import_utilisateurs.csv"');
    res.send(csv);
  }

  @Roles(Role.ADMIN)
  @Post('import/preview')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async previewImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier recu');
    }
    return this.usersService.parseAndPreview(file.buffer);
  }

  @Roles(Role.ADMIN)
  @Post('import/confirm')
  confirmImport(@Body() dto: ConfirmImportDto) {
    return this.usersService.confirmImport(dto.rows);
  }
}