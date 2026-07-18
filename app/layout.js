import "./globals.css";

export const metadata = {
  title: "SAT Prep Studio",
  description: "Timed SAT-style practice tests with score tracking and full attempt history",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="appbar">
          <div className="appbar-inner">
            <div>
              <span className="brand">SAT Prep Studio</span>
              <span className="brand-sub">Practice · Track · Improve</span>
            </div>
            <span className="goal-chip">Goal: 1400</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
