import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserImportService } from './user-import.service';

@Module({
  imports: [
    MulterModule.register({
      // Les fichiers d'import sont analyses en memoire : rien n'est ecrit sur
      // disque avant la confirmation par l'administrateur.
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService, UserImportService],
  exports: [UsersService],
})
export class UsersModule {}
