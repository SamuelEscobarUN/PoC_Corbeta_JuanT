import { createTheme } from '@mui/material/styles';

// Custom color palette for the Data Reconciliation Platform
const palette = {
  base: '#001689',
  white: '#fff',
  grayLight: '#f2f2f2',
  grayMedium: '#ededed',
  grayDark: '#e5e5e5',
  grayDarken: '#a1b1c8',
  cyan: '#2ed9c3',
  cyanDark: '#00c387',
  blue: '#0055b8',
  blueLight: '#00a1c6',
  blueDark: '#007c99',
  yellow: '#ffb548',
  yellowDark: '#efb000',
  yellowDarken: '#e8ab00',
  magenta: 'rgb(253, 74, 92)',
} as const;

const theme = createTheme({
  cssVariables: true,
  palette: {
    primary: {
      main: palette.base,
      light: palette.blue,
      dark: palette.blueDark,
      contrastText: palette.white,
    },
    secondary: {
      main: palette.cyan,
      light: palette.blueLight,
      dark: palette.cyanDark,
      contrastText: palette.white,
    },
    warning: {
      main: palette.yellow,
      dark: palette.yellowDark,
    },
    error: {
      main: palette.magenta,
    },
    background: {
      default: palette.grayLight,
      paper: palette.white,
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 600 },
    h2: { fontWeight: 600 },
    h3: { fontWeight: 600 },
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    body1: { fontWeight: 400, lineHeight: 1.6 },
    body2: { fontWeight: 400, lineHeight: 1.6 },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 20,
          transition: 'all 200ms ease-in-out',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          transition: 'all 200ms ease-in-out',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          transition: 'all 200ms ease-in-out',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          borderRadius: 0,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRadius: 0,
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: 12,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'all 200ms ease-in-out',
        },
      },
    },
  },
});

export { palette };
export default theme;
