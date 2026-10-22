import { FileQuestion } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/StatusViews';

export function NotFoundPage({ title = 'Page not found', message }: { title?: string; message?: string }) {
  return (
    <EmptyState
      icon={<FileQuestion className="size-6" aria-hidden="true" />}
      title={title}
      action={
        <Link to="/" className="text-sm font-medium text-brand-600 underline underline-offset-2">
          Back to documents
        </Link>
      }
    >
      {message ?? 'The page you are looking for does not exist.'}
    </EmptyState>
  );
}
