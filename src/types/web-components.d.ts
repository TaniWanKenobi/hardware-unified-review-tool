declare namespace JSX {
  interface IntrinsicElements {
    'kicanvas-embed': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      controls?: string;
      controlslist?: string;
      theme?: string;
      zoom?: string;
    };
    'kc-kicanvas-shell': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
  }
}
