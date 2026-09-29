import { useEffect, useState } from 'react';

/** Things the visitor can host on Troxe — cycles through these. */
export const HERO_WORDS = [
    'Discord Bot',
    'Telegram Bot',
    'Twitch Bot',
    'Kick Bot',
    'Node.js App',
    'Python Bot',
    'PHP Application',
    'Static Website',
];

/**
 * Typewriter effect: types the word, holds it, deletes it, moves to the next.
 * `words` must be a stable reference (module constant) — passing a literal
 * array would re-create the effect on every render.
 */
export default function RotatingText({
    words = HERO_WORDS,
    typeSpeed = 85,
    deleteSpeed = 40,
    holdTime = 1700,
    gapTime = 300,
}) {
    const [index, setIndex] = useState(0);
    const [text, setText] = useState(words[0]);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        const word = words[index % words.length];
        let timer;

        if (!deleting && text === word) {
            // finished typing — hold, then start deleting
            timer = setTimeout(() => setDeleting(true), holdTime);
        } else if (deleting && text === '') {
            // finished deleting — advance to the next word
            timer = setTimeout(() => {
                setIndex((i) => i + 1);
                setDeleting(false);
            }, gapTime);
        } else {
            timer = setTimeout(() => {
                setText(
                    deleting
                        ? word.slice(0, text.length - 1)
                        : word.slice(0, text.length + 1)
                );
            }, deleting ? deleteSpeed : typeSpeed);
        }

        return () => clearTimeout(timer);
    }, [text, deleting, index, words, typeSpeed, deleteSpeed, holdTime, gapTime]);

    return (
        <span className="whitespace-nowrap">
            {text}
            <span
                aria-hidden="true"
                className="ml-2 inline-block h-[0.78em] w-[5px] animate-blink bg-foreground align-middle"
            />
        </span>
    );
}
