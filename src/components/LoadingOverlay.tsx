import { useStore } from '../store/useStore';

export default function LoadingOverlay() {
  const { isLoading, error } = useStore();

  if (!isLoading && !error) return null;

  return (
    <div className="loading-overlay">
      {isLoading && (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading model...</p>
        </div>
      )}
      {error && (
        <div className="error-message">
          <div className="error-icon">⚠️</div>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
