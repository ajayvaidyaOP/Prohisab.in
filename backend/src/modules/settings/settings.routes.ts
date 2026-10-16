import { Router } from 'express';
import { requireAdminRole } from '../../middleware/auth.ts';
import { validate } from '../../middleware/validate.ts';
import {
  settingsUpdateBody,
  passwordChangeBody,
  entryOptionsBody,
  type SettingsUpdateBody,
  type PasswordChangeBody,
  type EntryOptionsBody,
} from './settings.schemas.ts';
import * as settings from './settings.service.ts';

export const settingsRouter = Router();

settingsRouter.get('/', async (req, res) => {
  res.json(await settings.getSettingsView(req.admin!.username));
});

settingsRouter.put('/', requireAdminRole, validate(settingsUpdateBody), async (req, res) => {
  res.json(await settings.updateSettings(req.body as SettingsUpdateBody, req.admin!.id));
});

settingsRouter.put('/entry-options', requireAdminRole, validate(entryOptionsBody), async (req, res) => {
  res.json(await settings.updateEntryOptions(req.body as EntryOptionsBody, req.admin!.id));
});

settingsRouter.post('/password', requireAdminRole, validate(passwordChangeBody), async (req, res) => {
  await settings.changePassword(req.body as PasswordChangeBody, req.admin!.id, req.sessionId);
  res.status(204).end();
});
