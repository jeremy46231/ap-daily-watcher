import { GraphQLClient } from 'jsr:@avalero/graphql-client@0.0.3'
import * as prompt from 'jsr:@cliffy/prompt@1.0.0-rc.7'

let bearerToken: string = ''
const permission = await Deno.permissions.query({
  name: 'env',
  variable: 'BEARER_TOKEN',
})
if (permission.state === 'granted')
  try {
    bearerToken = Deno.env.get('BEARER_TOKEN') || ''
  } catch {
    console.error('Error reading BEARER_TOKEN env. Will prompt for token.')
  }
if (!bearerToken) {
  const response = await prompt.Input.prompt({
    message: 'Enter your AP Classroom bearer token',
    hint: "Run localStorage.getItem('account_access_token') on apclassroom.collegeboard.org",
  })
  bearerToken = response.replaceAll(/^"|"$/g, '')
}
if (!bearerToken) {
  console.error('No BEARER_TOKEN provided')
  Deno.exit(1)
}

const fymEndpoint = 'https://apc-api-production.collegeboard.org/fym/graphql'
const unitsEndpoint =
  'https://apc-api-production.collegeboard.org/units/graphql'

const fymClient = new GraphQLClient(fymEndpoint)
const unitsClient = new GraphQLClient(unitsEndpoint)

/**
 * Fetches the user ID, user importId (for cbPersonid), current education period,
 * and available student subjects.
 *
 * @returns An object with userId, educationPeriod, userImportId, and subjects.
 */
async function getUserAndEducationPeriod(): Promise<{
  userId: number
  educationPeriod: string
  userImportId: string
  subjects: { id: string; name: string }[]
}> {
  const query = `
    query GetMe {
      me { initId, importId }
      studentSubjects { id, name }
      currentEducationPeriod { id }
    }
  `
  const result = await fymClient.query<
    {
      me: {
        initId: string
        importId: string
      }
      studentSubjects: { id: string; name: string }[]
      currentEducationPeriod: { id: string }
    },
    {}
  >(query, {
    variables: {},
    headers: { Authorization: `Bearer ${bearerToken}` },
  })
  return {
    userId: parseInt(result.me.initId),
    educationPeriod: result.currentEducationPeriod.id,
    userImportId: result.me.importId,
    subjects: result.studentSubjects,
  }
}

/**
 * Minimal course outline structure.
 */
type CourseOutline = {
  units: {
    displayName: string
    title: string
    subunits: {
      resources: {
        __typename: string
        videoId: string
        displayName: string
      }[]
    }[]
  }[]
}

/**
 * Fetches the course outline for a given subject and education period.
 *
 * @param subjectId - The subject ID as a string.
 * @param educationPeriod - The education period string.
 * @returns The course outline containing units, subunits, and resources.
 */
async function getCourseOutline(
  subjectId: string,
  educationPeriod: string
): Promise<CourseOutline> {
  const query = `
    query CourseOutline($subjectId: String!, $educationPeriod: String!, $filter: String) {
      courseOutline(subjectId: $subjectId, educationPeriod: $educationPeriod, filter: $filter) {
        units {
          displayName
          title
          subunits {
            resources {
              __typename
              ... on EmbeddedVideoResource {
                videoId
                displayName
              }
            }
          }
        }
      }
    }
  `
  const variables = { subjectId, educationPeriod, filter: null }
  const result = await unitsClient.query<
    { courseOutline: CourseOutline },
    typeof variables
  >(query, {
    variables,
    headers: { Authorization: `Bearer ${bearerToken}` },
  })
  return result.courseOutline
}

/**
 * Structure of the daily video progress response.
 */
type DailyVideoProgress = {
  dailyVideoProgress: {
    videoProgress: {
      progress: string
      watchedPercentage: string
      status: string
      playTimePercentage: string
      cbPersonid: string
    } | null
  }
}

/**
 * Fetches daily video progress for a given user and video.
 *
 * @param userId - The user's numeric ID.
 * @param videoId - The video's numeric ID.
 * @returns The parsed daily video progress.
 */
async function getDailyVideoProgress(
  userId: number,
  videoId: number
): Promise<DailyVideoProgress> {
  const query = `
    query DailyVideoProgress($userId: Int!, $videoId: Int!) {
      videoProgress(userId: $userId, videoId: $videoId)
    }
  `
  const variables = { userId, videoId }
  const result = await fymClient.query<
    { videoProgress: string },
    typeof variables
  >(query, {
    variables,
    headers: { Authorization: `Bearer ${bearerToken}` },
  })
  // videoProgress is returned as a JSON string; parse it to an object.
  return JSON.parse(result.videoProgress) as DailyVideoProgress
}

/**
 * Generates complete progress data.
 * If an original progress string is provided, it uses its length;
 * otherwise, it defaults to 20 segments.
 *
 * @param progressStr - (Optional) The original progress JSON string.
 * @returns A tuple containing:
 *  - newProgress: the complete progress array as a JSON string,
 *  - watchedPercentage: "1.0",
 *  - status: "COMPLETE",
 *  - playTimePercentage: "1.0".
 */
function makeCompleteProgress(
  progressStr?: string
): [string, string, string, string] {
  let completeArray: number[]
  if (progressStr) {
    const progressArray: number[] = JSON.parse(progressStr)
    completeArray = progressArray.map(() => 1)
  } else {
    // Default to 20 segments as an overestimate
    completeArray = Array(20).fill(1)
  }
  return [JSON.stringify(completeArray), '1.0', 'COMPLETE', '1.0']
}

/**
 * Updates the daily video progress by storing the complete progress.
 *
 * @param userId - The user's numeric ID.
 * @param cbPersonid - The cbPersonid to use (from the me endpoint).
 * @param videoId - The video's numeric ID.
 * @param progress - The new progress array (JSON string).
 * @param watchedPercentage - The new watched percentage ("1.0").
 * @param status - The new status ("COMPLETE").
 * @param playTimePercentage - The new play time percentage ("1.0").
 * @returns The result of the mutation.
 */
async function storeDailyVideoProgress(
  userId: number,
  cbPersonid: string,
  videoId: number,
  progress: string,
  watchedPercentage: string,
  status: string,
  playTimePercentage: string
): Promise<{ ok: boolean }> {
  const mutation = `
    mutation StoreDailyVideoProgressMutation(
      $userId: Int!,
      $cbPersonid: String!,
      $videoId: Int!,
      $status: String!,
      $progress: String!,
      $watchedPercentage: String!,
      $playTimePercentage: String!
    ) {
      storeDailyVideoProgress(
        userId: $userId,
        videoId: $videoId,
        status: $status,
        cbPersonid: $cbPersonid,
        progress: $progress,
        watchedPercentage: $watchedPercentage,
        playTimePercentage: $playTimePercentage
      ) {
        ok
        __typename
      }
    }
  `
  const variables = {
    userId,
    cbPersonid,
    videoId,
    status,
    progress,
    watchedPercentage,
    playTimePercentage,
  }
  const result = await fymClient.query<
    { storeDailyVideoProgress: { ok: boolean } },
    typeof variables
  >(mutation, {
    variables,
    headers: { Authorization: `Bearer ${bearerToken}` },
  })
  return result.storeDailyVideoProgress
}

// --- Top-level execution ---

const { userId, educationPeriod, userImportId, subjects } =
  await getUserAndEducationPeriod()
console.log(
  `User ID: ${userId} | Education Period: ${educationPeriod} | cbPersonid: ${userImportId}`
)

// Prompt for classes to update progress for.
const classOptions = subjects.map((sub) => ({ name: sub.name, value: sub.id }))
const selectedSubjects: string[] = await prompt.Checkbox.prompt({
  message: 'Select classes to update progress for',
  options: classOptions,
})
if (selectedSubjects.length === 0) {
  console.error('No classes selected.')
  Deno.exit(1)
}

for (const subjectId of selectedSubjects) {
  const subjectName =
    subjects.find((s) => s.id === subjectId)?.name || subjectId
  console.log(`\nProcessing subject: ${subjectName}`)
  const courseOutline = await getCourseOutline(subjectId, educationPeriod)
  if (!courseOutline.units || courseOutline.units.length === 0) {
    console.error(`No units found for subject ${subjectName}`)
    continue
  }
  // Build unit options based on unit index.
  const unitOptions = courseOutline.units.map((unit, idx) => ({
    name: `${unit.displayName}${unit.title ? `: ${unit.title}` : ''}`,
    value: idx,
  }))
  const selectedUnitIndices: number[] = await prompt.Checkbox.prompt({
    message: `Select units for ${subjectName}`,
    options: unitOptions,
  })
  if (selectedUnitIndices.length === 0) {
    console.log(`No units selected for subject ${subjectName}. Skipping.`)
    continue
  }

  // Process videos only in selected units.
  for (const unitIdx of selectedUnitIndices) {
    const unit = courseOutline.units[unitIdx]
    for (const subunit of unit.subunits) {
      for (const resource of subunit.resources) {
        if (
          resource.__typename === 'EmbeddedVideoResource' &&
          resource.videoId
        ) {
          const videoId = parseInt(resource.videoId)
          console.log(
            `Processing video: ${resource.displayName} (ID: ${videoId})`
          )
          try {
            const progressData = await getDailyVideoProgress(userId, videoId)
            const origProgress = progressData.dailyVideoProgress.videoProgress
            const [
              newProgress,
              newWatchedPercentage,
              newStatus,
              newPlayTimePercentage,
            ] = makeCompleteProgress(
              origProgress ? origProgress.progress : undefined
            )
            // console.log(`Updating progress for video ID: ${videoId}`)
            const updateResult = await storeDailyVideoProgress(
              userId,
              origProgress?.cbPersonid || userImportId,
              videoId,
              newProgress,
              newWatchedPercentage,
              newStatus,
              newPlayTimePercentage
            )
            if (!updateResult.ok) {
              console.error(
                `!!! Error updating progress for video ID ${videoId}:`,
                updateResult
              )
            }
            // console.log(`Update result for video ID ${videoId}:`, updateResult)
          } catch (error) {
            console.error(`!!! Error processing video ${videoId}:`, error)
          }
        }
      }
    }
  }
}
