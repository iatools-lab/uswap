export default async function run(page, ui) {
  const steps = [];

  // 1. Remplir le formulaire de connexion
  let snap = await ui.snapshot();
  steps.push({ step: 'login-snapshot', snap: snap.slice(0, 400) });

  const emailRef = snap.match(/@(e\d+) textbox/i)?.[1];
  // Trouver les champs via roles
  const inputs = page.locator('input');
  const count = await inputs.count();
  steps.push({ inputsCount: count });

  if (count >= 2) {
    await inputs.nth(0).fill('admin@upowa.org');
    await inputs.nth(1).fill(process.env.DEMO_PASSWORD ?? '');
  }

  // Cliquer sur "Se connecter"
  const submit = page.getByRole('button', { name: /se connecter/i });
  if (await submit.count()) {
    await submit.first().click();
  } else {
    await page.locator('form').locator('button[type=submit], button').last().click();
  }

  await page.waitForTimeout(3000);
  steps.push({ step: 'after-login', url: page.url(), title: await page.title() });

  // 2. Aller sur la page planning admin
  await page.goto('http://127.0.0.1:5173/app/admin/plannings');
  await page.waitForTimeout(3000);
  steps.push({ step: 'after-plannings', url: page.url(), title: await page.title() });

  const bodyText = await page.locator('body').innerText().catch(() => '');
  steps.push({ step: 'body-text', text: bodyText.slice(0, 800) });

  return steps;
}
