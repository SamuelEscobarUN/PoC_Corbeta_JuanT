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
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
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
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
        },
      },
    },
  },
});

export { palette };
export default theme;
