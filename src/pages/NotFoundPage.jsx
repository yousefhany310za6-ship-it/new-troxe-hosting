import { useNavigate } from 'react-router-dom';

import Footer from '../components/Footer.jsx';
import Navbar from '../components/Navbar.jsx';
import NotFound from '../components/NotFound.jsx';

export default function NotFoundPage() {
    const navigate = useNavigate();

    return (
        <>
            <Navbar />
            <NotFound backText="Back to home" onBack={() => navigate('/')} />
            <Footer />
        </>
    );
}
