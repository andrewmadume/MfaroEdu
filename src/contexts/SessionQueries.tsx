import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from './AuthContext';

function AccountQueries({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30000, refetchOnWindowFocus: true } },
      }),
  );
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// This boundary stays mounted on public/auth/offline routes too. Changing identity
// synchronously replaces both the cache and editor tree before either can render.
export default function SessionQueries({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return <AccountQueries key={session?.user.id ?? 'signed-out'}>{children}</AccountQueries>;
}
