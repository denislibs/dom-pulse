import { DomPulse } from './index';

declare global { interface Window { DomPulse: typeof DomPulse } }

window.DomPulse = DomPulse;
const script = document.currentScript as HTMLScriptElement | null;
if (!script || script.dataset.autostart !== 'false') DomPulse.start();
