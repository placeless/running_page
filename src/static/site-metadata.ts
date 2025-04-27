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

const getBasePath = () => {
  const baseUrl = import.meta.env.BASE_URL;
  return baseUrl === '/' ? '' : baseUrl;
};

const data: ISiteMetadataResult = {
  siteTitle: 'Keep Running',
  siteUrl: 'https://m.placeless.net',
  logo: 'https://avatars.githubusercontent.com/u/1621819?v=4',
  description: 'Personal site and blog',
  navLinks: [
    {
      name: 'Summary',
      url: `${getBasePath()}/summary`,
    },
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
