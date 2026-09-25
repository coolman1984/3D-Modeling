import { expect, type Page } from '@playwright/test';

/** Create a project through the "Create project" dialog and wait until the editor has it saved. */
export async function newProject(page: Page, name: string, width = 12, depth = 9, activity: 'hall' | 'office' = 'hall') {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('input[name="project-name"]').fill(name);
  if (activity !== 'hall') await page.locator(`[data-activity="${activity}"]`).click();
  await page.locator('input[name="new-width"]').fill(String(width));
  await page.locator('input[name="new-depth"]').fill(String(depth));
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText(name);
  await saved(page);
  return /#\/p\/([\w-]+)/.exec(page.url())![1]!;
}

export async function saved(page: Page) {
  await expect(page.getByTestId('save-state')).toHaveText(/^Saved · Revision \d+$/);
}

/** Send core commands the way any client does (one revision). Lengths in ticks: metres × 10 000. */
export async function send(page: Page, id: string, commands: unknown[]) {
  const { revision } = await (await page.request.get(`/api/projects/${id}`)).json();
  const response = await page.request.post(`/api/projects/${id}/commands`, { data: { commands, baseRevision: revision, actor: 'human' } });
  expect(response.ok()).toBe(true);
}

export const openTab = (page: Page, name: 'Properties' | 'Review' | 'History') => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
export const openPanel = (page: Page, name: 'Library' | 'Objects' | 'Space' | 'Precision') => page.locator('.rail-btn', { hasText: name }).click();
