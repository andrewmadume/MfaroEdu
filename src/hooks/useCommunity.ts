import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSchool } from '../contexts/SchoolContext';
import { validText } from '../lib/community';
import {
  moduleCall,
  inAppTransport,
  type CommunityModule,
  type ModuleRequest,
} from '../services/community';
export function useCommunityRead<T>(
  module: CommunityModule,
  request: ModuleRequest,
  enabled = true,
) {
  const { school } = useSchool();
  const editingSnapshot = request.op === 'settings' || request.op === 'loan';
  return useQuery({
    queryKey: ['community', module, school.id, request],
    queryFn: () => moduleCall<T>(module, 'read', school.id, request),
    enabled,
    refetchInterval: editingSnapshot ? false : 30000,
    refetchOnWindowFocus: !editingSnapshot,
  });
}
export function useCommunityWrite(module: CommunityModule) {
  const { school } = useSchool(),
    client = useQueryClient(),
    retry = useRef<{ signature: string; key: string } | null>(null);
  return useMutation({
    mutationFn: async (request: ModuleRequest) => {
      if (module === 'communication' && request.op === 'message')
        request = { ...request, body: validText(String(request.body), 5000) };
      const signature = JSON.stringify(request);
      if (!retry.current || retry.current.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      const values = { ...request, request_key: retry.current.key };
      return module === 'communication' && request.op === 'message'
        ? inAppTransport.send(school.id, {
            recipient_id: String(request.recipient_id),
            body: String(request.body),
            request_key: retry.current.key,
          })
        : moduleCall<{ id: string }>(module, 'write', school.id, values);
    },
    onSuccess: async () => {
      retry.current = null;
      await client.invalidateQueries({ queryKey: ['community', module, school.id] });
    },
  });
}
