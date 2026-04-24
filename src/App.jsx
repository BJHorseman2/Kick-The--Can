import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import Header from './components/Header';
import Footer from './components/Footer';
import Home from './pages/Home';
import Problem from './pages/Problem';
import LegalContract from './pages/LegalContract';
import MissingDisclosure from './pages/MissingDisclosure';
import DivorceIndustry from './pages/DivorceIndustry';
import YoungPeople from './pages/YoungPeople';
import Children from './pages/Children';
import Reform from './pages/Reform';
import Articles from './pages/Articles';
import ModelDisclosure from './pages/ModelDisclosure';

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="min-h-screen flex flex-col bg-white">
        <Header />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/problem" element={<Problem />} />
            <Route path="/legal-contract" element={<LegalContract />} />
            <Route path="/missing-disclosure" element={<MissingDisclosure />} />
            <Route path="/divorce-industry" element={<DivorceIndustry />} />
            <Route path="/young-people" element={<YoungPeople />} />
            <Route path="/children" element={<Children />} />
            <Route path="/reform" element={<Reform />} />
            <Route path="/articles" element={<Articles />} />
            <Route path="/model-disclosure" element={<ModelDisclosure />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}
