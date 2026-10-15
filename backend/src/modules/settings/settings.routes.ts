import { Router } from 'express';
import { validate } from '../../middleware/validate.ts';
import { settingsUpdateBody, passwordChangeBody, type SettingsUpdateBody, type PasswordChangeBody } from './settings.schemas.ts';
import * as settings from './settings.service.ts';

export const settingsRouter = Router();

settingsRouter.get('/', async (req, res) => {
  res.json(await settings.getSettingsView(req.admin!.username));
});

settingsRouter.put('/', validate(settingsUpdateBody), async (req, res) => {
  res.json(await settings.updateSettings(req.body as SettingsUpdateBody, req.admin!.id));
});

settingsRouter.post('/password', validate(passwordChangeBody), async (req, res) => {
  await settings.changePassword(req.body as PasswordChangeBody, req.admin!.id, req.sessionId);
  res.status(204).end();
});
