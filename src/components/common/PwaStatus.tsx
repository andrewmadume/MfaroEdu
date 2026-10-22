import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function PwaStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const {
    needRefresh: [refresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false),
      capture = (e: Event) => {
        e.preventDefault();
        setInstall(e as InstallEvent);
      };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('beforeinstallprompt', capture);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('beforeinstallprompt', capture);
    };
  }, []);
  return (
    <>
      {!online && (
        <div className="connection-banner" role="status">
          You’re offline. School records and changes require a connection.
        </div>
      )}
      {refresh && (
        <div className="connection-banner" role="status">
          An update is ready. Save your work before reloading.{' '}
          <button onClick={() => void updateServiceWorker(true)}>Reload</button>
        </div>
      )}
      {install && (
        <button
          className="install-button secondary"
          onClick={async () => {
            await install.prompt();
            await install.userChoice;
            setInstall(null);
          }}
        >
          Install app
        </button>
      )}
    </>
  );
}
