import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Library } from './pages/Library';
import { Reader } from './pages/Reader';
import { FurtherReadingPage } from './pages/FurtherReadingPage';
import { NotesPage } from './pages/NotesPage';
import { Settings } from './pages/Settings';
import Journal from './pages/Journal';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/reader/:paperId" element={<Reader />} />
        <Route path="/further-reading" element={<FurtherReadingPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
