// Imported first by main.tsx: schemas are created when their modules load, so this must run earlier.
// The page's Content-Security-Policy forbids generated code; tell zod not to try it.
import { z } from 'zod';

z.config({ jitless: true });
