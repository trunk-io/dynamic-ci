import { getOctokit } from "@actions/github";

/** An Octokit for the run's GitHub host (`GITHUB_API_URL`, for GitHub Enterprise Server). */
export const githubClient = (token: string): ReturnType<typeof getOctokit> =>
  getOctokit(token, {
    baseUrl: process.env["GITHUB_API_URL"] || "https://api.github.com",
  });
