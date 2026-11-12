// Netlify Function serving the AquaFlow API at /api/* on the same site as the app.
// Settings (DATABASE_URL, PayHero keys, ...) are Netlify environment variables with the "Functions" scope.
import { handle } from '../../server/api.mjs';

export default (request) => handle(request);

export const config = {
  path: '/api/*',
};
