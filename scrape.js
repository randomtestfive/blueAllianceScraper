const request = require("sync-request");
const fs = require("fs");
const api_key = JSON.parse(fs.readFileSync("api.json")).key;

function blueApi(endpoint, param) {
  var res = request("GET", "https://www.thebluealliance.com/api/v3"+endpoint, {
    headers: {
      "X-TBA-Auth-Key": api_key
    },
    qs: param,
  });
  console.log("hit api");

  return JSON.parse(res.getBody('utf8'));
}

function cacheBlueApi(endpoint) {
  var res;
  const loc = "api"+endpoint;
  const dat_loc = loc+"/data.json"
  if(fs.existsSync(loc)) {
    if(fs.existsSync(dat_loc)) {
      res = JSON.parse(fs.readFileSync(dat_loc));
    } else {
      res = blueApi(endpoint);
      console.log("caching");
      fs.writeFileSync(dat_loc, JSON.stringify(res));
    }
  } else {
    fs.mkdirSync(loc, {recursive: true});

    res = blueApi(endpoint);
    console.log("caching");
    fs.writeFileSync(dat_loc, JSON.stringify(res));
  }
  return res;
}

function matchesForEvent(event) {
  return cacheBlueApi("/event/"+event+"/matches");
}

function matchesForTeamAtEvent(team, event) {
  return cacheBlueApi("/team/"+team+"/event/"+event+"/matches");
}

function matchesForTeamInYear(team, year) {
  return cacheBlueApi("/team/"+team+"/matches/"+year);
}

function onSeasonEventsForTeamInYear(team, year) {
  return cacheBlueApi("/team/"+team+"/events/"+year)
    .filter(e => e.event_type_string !== "Offseason")
    .filter(e => e.event_type_string !== "Preseason");
}

function eventsInYearKey(year) {
  return cacheBlueApi("/events/"+year+"/keys");
}

function eventsInYear(year) {
  return cacheBlueApi("/events/"+year);
}

function onSeasonMatchesForTeamInYear(team, year) {
  const events = eventsInYear(year)
    .filter(e => e.event_type_string !== "Offseason")
    .filter(e => e.event_type_string !== "Preseason")
    .map(e => e.key);
  const all_matches = matchesForTeamInYear(team, year);
  const matches = all_matches.filter(m => events.includes(m.event_key));
  return matches;
}

function onSeasonScoresForTeamInYear(team, year) {
  const matches = onSeasonMatchesForTeamInYear(team, year);
  return matches.map(m => {
    return m.alliances.red.team_keys.includes(team) ?
      [m.alliances.red.score, m.alliances.blue.score] :
      [m.alliances.blue.score, m.alliances.red.score];
  })
}

function calcWinRateForTeamInYear(team, year) {
  const matches = onSeasonMatchesForTeamInYear(team, year);
  const wins = matches.filter(m => {
    const alliance = m.alliances.red.team_keys.includes(team) ? "red" : "blue";
    const win = m.winning_alliance === alliance;
    return win;
  }).length;
  return wins / matches.length;
}

function calcAverageSeedForTeamInYear(team, year) {
  const events = onSeasonEventsForTeamInYear(team, year)
    .map(e => e.key);

  if(events.length === 0) {
    return "";
  }

  const ranks = events
      .map(e => cacheBlueApi("/event/"+e+"/rankings"))
      .filter(r => r.rankings.length !== 0)
      .map(rankings => {
        const rank = rankings.rankings.filter(r => r.team_key === team);
        if(rank.length !== 0) {
          return rank[0].rank;
        } else {
          return rankings.rankings.length+1;
        }
      });
  const rank_avg = (ranks.reduce((a,b) => a+b)/ranks.length);
  return rank_avg;
}

function calcAverageScoreForTeamInYear(team, year) {
  const score = onSeasonScoresForTeamInYear(team, year)
    .map(s => s[0]);
  return (score.reduce((a,b) => a+b) / score.length);
}

function calcAverageOppScoreForTeamInYear(team, year) {
  const score = onSeasonScoresForTeamInYear(team, year)
    .map(s => s[1]);
  return (score.reduce((a,b) => a+b) / score.length);
}

function calcAverageScoreDifferenceForTeamInYear(team, year) {
  const score = onSeasonScoresForTeamInYear(team, year)
    .map(s => s[0]-s[1]);
  return (score.reduce((a,b) => a+b) / score.length);
}

function teamsInYear(year) {
  var teams = [];
  for(var i = 0; i < 16; i++) {
    teams = teams.concat(cacheBlueApi("/teams/"+year+"/"+i+"/keys"));
  }
  return teams;
}

function teamsWithMatchesInYear(year) {
  const teams = teamsInYear(year);
  return teams.filter(t => onSeasonMatchesForTeamInYear(t, year).length !== 0);
}

function allTeamsAverages2018() {
  const teams = teamsWithMatchesInYear("2018");

  const data = teams.map(team => {
    console.log(team);
    return team + ","
      + calcWinRateForTeamInYear(team, "2018") + ","
      + calcAverageSeedForTeamInYear(team, "2018") + ","
      + calcAverageScoreForTeamInYear(team, "2018") + ","
      + calcAverageOppScoreForTeamInYear(team, "2018") + ","
      + calcAverageScoreDifferenceForTeamInYear(team, "2018");
  });

  const header = "team,winrate,seed,score,oppscore,scorediff\n";

  fs.writeFileSync("big_scrape.csv", header+data.join("\n"));
}

function timeSeriesAtEvent(event) {
  return cacheBlueApi("/event/"+event+"/matches/timeseries");
}

function onSeasonMatchesWithTimeseriesForTeamInYear(team, year) {
  const events = onSeasonEventsForTeamInYear(team, year)
    .map(e => e.key);
  const timeseries_matches = events
    .map(e => {
      const matches = matchesForTeamAtEvent(team, e).map(m => m.key);
      const t_match = timeSeriesAtEvent(e);
      return matches.filter(m => t_match.includes(m));
    })
    .flat();
  return timeseries_matches;
}

function allianceOfTeamInMatch(team, match) {
  const match_dat = cacheBlueApi("/match/"+match);
  return match_dat.alliances.red.team_keys.includes(team) ? "red" : "blue";
}

function timeToCaptureNearSwitchInMatchForTeam(match, team) {
  const timeseries = cacheBlueApi("/match/"+match+"/timeseries");
  const alliance = allianceOfTeamInMatch(team, match);
  for(var i = 0; i < timeseries.length; i++) {
    if(timeseries[i][alliance+"_switch_owned"] === 1) {
      return i;
    }
  }
}

function timeToCaptureScaleInMatchForTeam(match, team) {
  const timeseries = cacheBlueApi("/match/"+match+"/timeseries");
  const alliance = allianceOfTeamInMatch(team, match);
  for(var i = 0; i < timeseries.length; i++) {
    if(timeseries[i][alliance+"_scale_owned"] === 1) {
      return i;
    }
  }
}

function timesToCaptureNearSwitchForTeamInYear(team, year) {
  const matches = onSeasonMatchesWithTimeseriesForTeamInYear(team, year);
  return matches.map(m => timeToCaptureNearSwitchInMatchForTeam(m, team));
}

function timesToCaptureScaleForTeamInYear(team, year) {
  const matches = onSeasonMatchesWithTimeseriesForTeamInYear(team, year);
  return matches.map(m => timeToCaptureScaleInMatchForTeam(m, team));
}

function secondsNearSwitchForTeamInMatch(team, match) {
  const match_dat = cacheBlueApi("/match/"+match);
  const alliance = allianceOfTeamInMatch(team, match);
  return match_dat.score_breakdown[alliance].teleopSwitchOwnershipSec +
    match_dat.score_breakdown[alliance].autoSwitchOwnershipSec;
}

function ratiosNearSwitchForTeam(team) {
  const matches = onSeasonMatchesWithTimeseriesForTeamInYear(team, "2018");
  return matches
    .map(m => secondsNearSwitchForTeamInMatch(team, m) / 150);
}

function secondsScaleForTeamInMatch(team, match) {
  const match_dat = cacheBlueApi("/match/"+match);
  const alliance = allianceOfTeamInMatch(team, match);
  return match_dat.score_breakdown[alliance].teleopScaleOwnershipSec +
    match_dat.score_breakdown[alliance].autoScaleOwnershipSec;
}

function ratiosScaleForTeam(team) {
  const matches = onSeasonMatchesWithTimeseriesForTeamInYear(team, "2018");
  return matches
    .map(m => secondsScaleForTeamInMatch(team, m) / 150);
}

function secondsFarSwitchForTeamInMatch(team, match) {
  const match_dat = cacheBlueApi("/match/"+match);
  const alliance = allianceOfTeamInMatch(team, match) === "red" ? "blue" : "red";
  return match_dat.score_breakdown[alliance].teleopSwitchOwnershipSec +
    match_dat.score_breakdown[alliance].autoSwitchOwnershipSec;
}

function ratiosFarSwitchForTeam(team) {
  const matches = onSeasonMatchesWithTimeseriesForTeamInYear(team, "2018");
  return matches
    .map(m => secondsFarSwitchForTeamInMatch(team, m) / 150);
}

function timeseriesStats() {
  const teams = ["frc254", "frc558", "frc1741", "frc3933", "frc6372"];

  const times = teams.map(t => ({
    team: t,
    nearSwitch: timesToCaptureNearSwitchForTeamInYear(t, "2018"),
    scale: timesToCaptureScaleForTeamInYear(t, "2018"),
    nearSwitchRatio: ratiosNearSwitchForTeam(t),
    scaleRatio: ratiosScaleForTeam(t),
    farSwitchRatio: ratiosFarSwitchForTeam(t)
  }));

  const data = times
    .map(t => {
      return t.nearSwitch.map((n, i) =>
        [ t.team,
          n,
          t.scale[i],
          t.nearSwitchRatio[i],
          t.scaleRatio[i],
          t.farSwitchRatio[i]
        ].join(","));
    })
    .flat();

  const header = "team,switch,scale,rn_switch,r_scale,rf_switch\n"

  fs.writeFileSync("times.csv", header+data.join("\n"));
}

function timeScaleNeutralInMatch(match) {
  const match_dat = cacheBlueApi("/match/"+match);
  const red_own = match_dat.score_breakdown.red.autoScaleOwnershipSec
    + match_dat.score_breakdown.red.teleopScaleOwnershipSec;
  const blue_own = match_dat.score_breakdown.blue.autoScaleOwnershipSec
    + match_dat.score_breakdown.blue.teleopScaleOwnershipSec;

  return [red_own, blue_own, 150 - (red_own + blue_own)];
}

//allTeamsAverages2018();
//timeseriesStats();

//console.log(timeScaleNeutralInMatch("2018gal_qm92"));
