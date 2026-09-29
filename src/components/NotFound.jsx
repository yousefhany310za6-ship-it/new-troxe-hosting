import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeftIcon } from 'lucide-react';

import { Button } from './ui/button.jsx';
import { Globe } from './ui/cosmic-404.jsx';

/* 🎞️ Animation Variants */
const fadeUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: 'easeOut' } },
};

const globeVariants = {
    hidden: { scale: 0.85, opacity: 0, y: 10 },
    visible: {
        scale: 1,
        opacity: 1,
        y: 0,
        transition: { duration: 1, ease: 'easeOut' },
    },
    floating: {
        y: [-4, 4],
        transition: {
            duration: 5,
            ease: 'easeInOut',
            repeat: Infinity,
            repeatType: 'reverse',
        },
    },
};

export function NotFound({
    title = 'Ups! Lost in space',
    description = 'We couldn’t find the page you’re looking for. It might have been moved or deleted.',
    backText = 'Go Back',
    onBack,
}) {
    return (
        <div className="flex h-[88vh] flex-col items-center justify-center bg-background px-4">
            <AnimatePresence mode="wait">
                <motion.div
                    className="text-center"
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                    variants={fadeUp}
                >
                    <div className="mb-10 flex items-center justify-center gap-6">
                        <motion.span
                            className="select-none text-7xl font-bold text-foreground/80 md:text-8xl"
                            variants={fadeUp}
                        >
                            4
                        </motion.span>

                        <motion.div
                            className="relative h-24 w-24 md:h-32 md:w-32"
                            variants={globeVariants}
                            animate={['visible', 'floating']}
                        >
                            <Globe />
                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.08)_0%,transparent_70%)]" />
                        </motion.div>

                        <motion.span
                            className="select-none text-7xl font-bold text-foreground/80 md:text-8xl"
                            variants={fadeUp}
                        >
                            4
                        </motion.span>
                    </div>

                    <motion.h1
                        className="mb-4 text-3xl font-semibold tracking-tight text-foreground md:text-5xl"
                        variants={fadeUp}
                    >
                        {title}
                    </motion.h1>

                    <motion.p
                        className="mx-auto mb-10 max-w-md text-base text-muted-foreground/70 md:text-lg"
                        variants={fadeUp}
                    >
                        {description}
                    </motion.p>

                    <motion.div variants={fadeUp}>
                        <Button
                            className="cursor-pointer gap-2 transition-all duration-500 hover:scale-105"
                            onClick={onBack}
                        >
                            <ArrowLeftIcon className="h-5 w-5" />
                            {backText}
                        </Button>
                    </motion.div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
}

export default NotFound;
