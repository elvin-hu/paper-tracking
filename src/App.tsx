import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Library } from './pages/Library';
import { Reader } from './pages/Reader';
import { FurtherReadingPage } from './pages/FurtherReadingPage';
import { NotesPage } from './pages/NotesPage';
import { Settings } from './pages/Settings';
import { Auth } from './pages/Auth';
import { Account } from './pages/Account';
import { Compose } from './pages/Compose';
import Journal from './pages/Journal';
import { LitReview } from './pages/LitReview';
import { ProjectProvider } from './contexts/ProjectContext';
import { AuthProvider } from './contexts/AuthContext';
import { FeatureFlagProvider } from './contexts/FeatureFlagContext';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  return (
    <AuthProvider>
      <FeatureFlagProvider>
        <ProjectProvider>
          <BrowserRouter>
            <Routes>
              {/* Public route */}
              <Route path="/auth" element={<Auth />} />
              
              {/* Protected routes */}
              <Route path="/" element={
                <ProtectedRoute>
                  <Library />
                </ProtectedRoute>
              } />
              <Route path="/reader/:paperId" element={
                <ProtectedRoute>
                  <Reader />
                </ProtectedRoute>
              } />
              <Route path="/further-reading" element={
                <ProtectedRoute>
                  <FurtherReadingPage />
                </ProtectedRoute>
              } />
              <Route path="/notes" element={
                <ProtectedRoute>
                  <NotesPage />
                </ProtectedRoute>
              } />
              <Route path="/journal" element={
                <ProtectedRoute>
                  <Journal />
                </ProtectedRoute>
              } />
              <Route path="/compose" element={
                <ProtectedRoute>
                  <Compose />
                </ProtectedRoute>
              } />
              <Route path="/lit-review" element={
                <ProtectedRoute>
                  <LitReview />
                </ProtectedRoute>
              } />
              <Route path="/settings" element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              } />
              <Route path="/account" element={
                <ProtectedRoute>
                  <Account />
                </ProtectedRoute>
              } />
            </Routes>
          </BrowserRouter>
        </ProjectProvider>
      </FeatureFlagProvider>
    </AuthProvider>
  );
}

export default App;
