import "./globals.css";
import { Bebas_Neue, Space_Grotesk } from "next/font/google";

const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = {
  title: "ClipForge",
  description: "Generate vertical highlight clips with subtitles."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning className={`${bebas.variable} ${space.variable}`}>
      <body suppressHydrationWarning className="min-h-screen bg-ink text-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(36,212,255,0.15),_transparent_60%),radial-gradient(circle_at_20%_80%,_rgba(255,107,74,0.2),_transparent_50%)]" />
        <div className="absolute left-[-20%] top-10 h-96 w-96 rounded-full bg-neon/10 blur-[120px]" />
        <div className="absolute right-[-10%] bottom-10 h-96 w-96 rounded-full bg-ember/10 blur-[140px]" />
        <main className="relative mx-auto w-full max-w-6xl px-6 py-12 md:px-10">
          {children}
        </main>
      </body>
    </html>
  );
}
