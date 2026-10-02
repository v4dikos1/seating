import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';

import { LabProvider } from '../app/state';
import { MockPaymentPage } from './mock-payment-page';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <LabProvider>
      <MockPaymentPage />
    </LabProvider>
  </StrictMode>,
);
