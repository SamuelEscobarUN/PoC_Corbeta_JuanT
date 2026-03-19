/**
 * UploadPage — main page combining the file upload form and upload history.
 */
import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import FileUploadForm from '../organisms/FileUploadForm';
import UploadHistory from '../organisms/UploadHistory';

export default function UploadPage() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} role="region" aria-label="Carga de archivos">
      <Typography variant="h4" component="h1">Carga de Archivos</Typography>

      <FileUploadForm
        onUploadComplete={() => setRefreshTrigger((n) => n + 1)}
      />

      <UploadHistory refreshTrigger={refreshTrigger} />
    </Box>
  );
}
