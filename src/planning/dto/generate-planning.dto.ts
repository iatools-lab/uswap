import {
IsArray,
IsIn,
IsNotEmpty,
IsOptional,
IsString,
ValidateNested,
} from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';

export class PlanningStationSelectionDto {
@ApiProperty({
example: 'uuid-de-la-station',
description: 'Station concernee par le planning.',
})
@IsString()
@IsNotEmpty()
stationId: string;

@ApiProperty({
type: [String],
example: [
'uuid-swapper-1',
'uuid-swapper-2',
],
description:
'Swappeurs selectionnes pour cette station. En mode automatique, cette liste peut etre omise.',
required: false,
})
@IsOptional()
@IsArray()
@IsString({ each: true })
swapperIds?: string[];

@ApiProperty({
type: [String],
example: [
'MORNING',
'AFTERNOON',
'NIGHT',
],
description:
'Shifts selectionnes pour cette station. En mode automatique, les trois shifts par defaut sont utilises.',
required: false,
})
@IsOptional()
@IsArray()
@IsString({ each: true })
@IsIn(
[
'MORNING',
'AFTERNOON',
'NIGHT',
],
{ each: true },
)
shiftNames?: string[];
}

export class GeneratePlanningDto {
@ApiProperty({
type: [PlanningStationSelectionDto],
example: [
{
stationId: 'uuid-station-1',
swapperIds: [
'uuid-swapper-1',
'uuid-swapper-2',
],
shiftNames: [
'MORNING',
'AFTERNOON',
'NIGHT',
],
},
],
description:
'Stations concernees. En mode automatique, les swapperIds et shiftNames peuvent etre omis.',
})
@IsArray()
@ValidateNested({ each: true })
@Type(() => PlanningStationSelectionDto)
stations: PlanningStationSelectionDto[];
}