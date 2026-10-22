import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocuments } from './documents-context';

/** Creates a document and navigates to it. Shared by the header, sidebar and dashboard. */
export function useCreateDocument() {
  const { create } = useDocuments();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const createAndOpen = useCallback(async () => {
    setCreating(true);
    const doc = await create();
    setCreating(false);
    if (doc) navigate(`/d/${doc.id}`);
  }, [create, navigate]);

  return { createAndOpen, creating };
}
