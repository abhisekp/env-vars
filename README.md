# Env Vars
A script to download and store all environment variables from web and store in database

# Requirements

1. MongoDB
2. Github Account

# Installation

Install required packages

```sh
yarn
```

# Usage

1. Copy `example.env` to `.env` and Setup Environment Variables.
2. Run  
    ```
    yarn start
    ```

# Contribution

The code is thrown-error resilient.

1. Iteratively scans through the github search result pages with time and reset information from headers.
2. Fetches the text and parses to get env vars.
3. Saves info to DB one at a time.

# Release

Released in Kaggle as dataset.   
:point_right: https://www.kaggle.com/abhisekp/environment-variables
