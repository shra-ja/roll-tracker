import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(async () => {
  document.body.innerHTML = '<main></main>';
  vi.resetModules();
  await import('../src/main');
});

test('starts with accessible game selection and an honest offline empty state', () => {
  expect(document.querySelector('h1')?.textContent).toBe('Your rolls, kept local.');
  const select = document.querySelector('select')!;
  expect(document.querySelector('label')?.htmlFor).toBe(select.id);
  expect([...select.options].map(option => option.textContent)).toEqual([
    'Genshin Impact', 'Honkai: Star Rail',
  ]);
  expect(select.value).toBe('genshin-impact');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No Genshin Impact rolls yet');
  expect(document.body.textContent).toContain('File import is coming next.');
  expect(document.body.textContent).toContain('Offline');
  expect(document.querySelector('button')).toBeNull();
});

test('switches games and switches back without inventing history or statistics', () => {
  const select = document.querySelector('select')!;
  select.value = 'honkai-star-rail';
  select.dispatchEvent(new Event('change'));
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No Honkai: Star Rail rolls yet');
  select.value = 'genshin-impact';
  select.dispatchEvent(new Event('change'));
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No Genshin Impact rolls yet');
  expect(document.body.textContent).not.toMatch(/pity|guarantee|win rate/i);
});
