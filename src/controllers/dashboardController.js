export function creatorDashboard(_request, response) {
  response.json({
    stats: {
      totalGamesCreated: 10,
      totalPlays: 24800,
      averageRating: 4.8,
      totalRevenue: 1920
    },
    pipeline: {
      templateCreates: 932,
      aiRefinements: 118,
      publishJobs: 74,
      averageTemplateSeconds: 24
    },
    recentGames: [
      { title: "Neon Flappy Bird", plays: 4200, rating: 4.9, revenue: 320 },
      { title: "Retro Match-3 Puzzle", plays: 3800, rating: 4.7, revenue: 260 },
      { title: "Space Runner", plays: 6100, rating: 4.8, revenue: 540 }
    ]
  });
}
