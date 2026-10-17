import 'Components/Form/FormInputGroup';
import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ImportMovie from 'AddMovie/ImportMovie/Import/ImportMovie';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InteractiveImportModal from 'InteractiveImport/InteractiveImportModal';
import { setTranslations } from 'Utilities/String/translate';
import translations from '../../../src/NzbDrone.Core/Localization/Core/en.json';

setTranslations(translations);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <BrowserRouter>
      <Routes>
        <Route path="/add/import/scenes/:rootFolderId" element={<div style={{ display: 'flex', height: '100vh', width: '100%' }}><ImportMovie itemType="scene" /></div>} />
        <Route path="/queue-import" element={<InteractiveImportModal isOpen={true} downloadIds={['first', 'second']}
          onModalClose={() => { document.title = 'closed'; }} />} />
        <Route path="*" element={<InteractiveImportModal isOpen={true} folder="/fixture" showDelete={true}
          showFilterExistingFiles={true} onModalClose={() => { document.title = 'closed'; }} />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);
