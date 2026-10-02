import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';

import WidgetApp from './widget-app';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <WidgetApp />
  </StrictMode>,
);
