from pathlib import Path
p=Path('uswap-danielle/uswap-danielle/src/shifts/shifts.service.ts')
s=p.read_text(encoding='utf-8')
s=s.replace("import { serial } from '../transaction';","import { serial } from '../transaction';\nimport { inspectShift } from './shift-constraints';")
a=s.index('  async validate(');b=s.index('  async create(',a)
s=s[:a]+'''  async preview(dto: CreateShiftDto) {
    return serial(this.prisma, tx => inspectShift(tx, dto));
  }
  async validate(tx, dto, excluded?: string) {
    const report = await inspectShift(tx, dto, excluded);
    if (!report.valid) throw new ConflictException({message:report.errors[0].message,issues:report.errors});
    return {start:new Date(dto.startTime),end:new Date(dto.endTime)};
  }
'''+s[b:]
p.write_text(s,encoding='utf-8')
