import {
  loadNavSettings,
  NAV_SETTINGS_UPDATED_EVENT,
  saveNavSettings,
} from './nav-settings';

beforeEach(() => localStorage.clear());
it('defaults to visible navigation and persists explicit opt-in and opt-out', () => {
  expect(loadNavSettings().autoHideNav).toBe(false);
  const changed = jest.fn();
  window.addEventListener(NAV_SETTINGS_UPDATED_EVENT, changed);
  expect(saveNavSettings({ autoHideNav: true }).autoHideNav).toBe(true);
  expect(loadNavSettings().autoHideNav).toBe(true);
  saveNavSettings({ autoHideNav: false });
  expect(loadNavSettings().autoHideNav).toBe(false);
  expect(changed).toHaveBeenCalledTimes(2);
  window.removeEventListener(NAV_SETTINGS_UPDATED_EVENT, changed);
});
it('ignores malformed stored preferences', () => {
  localStorage.setItem('autoHideNav', 'yes');
  expect(loadNavSettings().autoHideNav).toBe(false);
});
