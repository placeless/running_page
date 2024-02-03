interface ISiteMetadataResult {
  siteTitle: string;
  siteUrl: string;
  description: string;
  logo: string;
  navLinks: {
    name: string;
    url: string;
  }[];
}

const data: ISiteMetadataResult = {
  siteTitle: 'Running Page',
  siteUrl: 'https://m.placeless.net',
  logo: 'https://avatars.githubusercontent.com/u/1621819?v=4',
  description: 'Personal site and blog',
  navLinks: [
    {
      name: 'Blog',
      url: 'https://placeless.net',
    },
    {
      name: 'About',
      url: 'https://github.com/placeless/running_page',
    },
  ],
};

export default data;
