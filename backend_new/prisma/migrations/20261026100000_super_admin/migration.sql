-- Role SUPER_ADMIN : vue et pouvoirs plus larges que l'administrateur.
--
-- `ALTER TYPE ... ADD VALUE` est strictement additif et ne touche aucune
-- donnee. Il n'est pas reversible (`DROP VALUE` n'existe pas) : revenir a
-- l'image precedente serait donc sans effet sur les valeurs deja stockees,
-- ce qui est sans danger puisqu'aucune ligne ne portait ce role avant.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN' BEFORE 'ADMIN';
