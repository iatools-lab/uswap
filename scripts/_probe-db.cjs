/* Sondage temporaire de l'etat de la base uSwap (a supprimer apres usage). */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

(async () => {
  try {
    const users = await prisma.user.findMany({
      select: { email: true, role: true, fullName: true, isActive: true },
    });
    console.log("USERS:", users.length);
    users.forEach((u) => console.log(" -", u.role, u.isActive ? "actif" : "inactif", u.email));

    const counts = {
      Station: await prisma.station.count(),
      Shift: await prisma.shift.count(),
      Planning: await prisma.planning.count(),
      Attendance: await prisma.attendance.count(),
      LeaveRequest: await prisma.leaveRequest.count(),
      Notification: await prisma.notification.count(),
      ShiftTemplate: await prisma.shiftTemplate.count(),
      ReplacementRequest: await prisma.replacementRequest.count(),
      ShiftChange: await prisma.shiftChange.count(),
    };
    console.log("COUNTS:", JSON.stringify(counts, null, 2));
  } catch (error) {
    console.log("ERR", error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
