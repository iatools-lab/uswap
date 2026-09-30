import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { LeaveService } from './leave.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leave-requests')
export class LeaveController {
  constructor(private leaveService: LeaveService) {}

  @Roles(Role.SWAPPER)
  @Post()
  create(@Request() req, @Body() dto: CreateLeaveRequestDto) {
    return this.leaveService.create(req.user.id, dto);
  }

  @Get('mine')
  findMine(@Request() req) {
    return this.leaveService.findMine(req.user.id);
  }
}