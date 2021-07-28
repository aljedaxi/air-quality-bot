import fetch from 'node-fetch'
import S from 'sanctuary'
import TelegramBot from 'node-telegram-bot-api'
import { ToadScheduler, SimpleIntervalJob, AsyncTask } from 'toad-scheduler'
import { readFile, writeFile } from 'fs/promises'

const trace = s => {console.log(s); return s;};

const { TELEGRAM_TOKEN: telegramToken, WAQI_TOKEN: waqiToken } = process.env
const myCity = 'calgary'
if (!telegramToken || !waqiToken) {
	throw new Error ('fuck me out')
}

const {
	pipe,
	prop,
} = S

const levelData = {
	Good: {
		name: 'Good',
		implications: `Air quality is considered satisfactory, and air pollution poses little or no risk`,
		statement: 'None',
		AQI: [0, 50],
	},
	Moderate: {
		name: 'Moderate',
		implications: `Air quality is acceptable; however, for some pollutants there may be a moderate health concern for a very small number of people who are unusually sensitive to air pollution.`,
		statement: `Active children and adults, and people with respiratory disease, such as asthma, should limit prolonged outdoor exertion.`,
		AQI: [51, 100],
	},
	'Unhealthy for Sensitive Groups': {
		name: 'Unhealthy for Sensitive Groups',
		implications: `Members of sensitive groups may experience health effects. The general public is not likely to be affected.`,
		statement: `Active children and adults, and people with respiratory disease, such as asthma, should limit prolonged outdoor exertion.`,
		AQI: [101, 150],
	},
	Unhealthy : {
		name: 'Unhealthy',
		implications: `Everyone may begin to experience health effects; members of sensitive groups may experience more serious health effects`,
		statement: `Active children and adults, and people with respiratory disease, such as asthma, should avoid prolonged outdoor exertion; everyone else, especially children, should limit prolonged outdoor exertion`,
		AQI: [151, 200],
	},
	'Very Unhealthy': {
		name: 'VeryUnhealthy',
		implications: `Health warnings of emergency conditions. The entire population is more likely to be affected.`,
		statement: `Active children and adults, and people with respiratory disease, such as asthma, should avoid all outdoor exertion; everyone else, especially children, should limit outdoor exertion.`,
		AQI: [201, 300],
	},
	Hazardous: {
		name: 'Hazardous',
		implications: `Health alert: everyone may experience more serious health effects`,
		statement: `Everyone should avoid all outdoor exertion`,
		AQI: [300, ],
	},
}

const scoreToEnglish = 
	n => 
		n < 50  ? 'Good'
	: n < 100 ? 'Moderate'
	: n < 150 ? 'Unhealthy for Sensitive Groups'
	: n < 200 ? 'Unhealthy'
	: n < 300 ? 'Very Unhealthy'
	: n > 300 ? 'Hazardous'
	: /*     */ 'wut'

const getAirQuality = pipe([
	prop ('iaqi'),
	prop ('pm25'),
	prop ('v'),
	n => ({...levelData[scoreToEnglish (n)], aqi: n})
])

const getFor = city =>
	fetch (`http://api.waqi.info/feed/${city}/?token=${waqiToken}`)
		.then(
			r => r.ok 
				? r.json() 
				: Promise.reject (r.json())
		)
		.then(prop ('data'))
// getFor ('calgary')
// 	.then(getAirQuality)
// 	.then(console.log)

// bot.onMessage 
// const channels = [{channel, city}]
// /enable/i.test
// ? register the channel id
// : nothing
// /disable/i.test
// ? unregister the channel id
// every hour
// channels.forEach(sendData
const getMessageText = msg => msg.text.toString()

const readChannels = _ => readFile('./channels.json').then(JSON.parse)
const writeChannels = os => writeFile('./channels.json', JSON.stringify (os))
const appendToChannels = o => readChannels ().then(
	xs => xs.filter(x => x.channelId === o.channelId).length > 0
		? Promise.reject ('already here!')
		: writeChannels ([...xs, o])
)

const formatMessage = ({name, aqi, url}) =>
	`${aqi} - ${name}\nSee ${url} for more information.`
const main = ({ scheduler, bot, }) => {
	const city = 'calgary'
	let channels = []

	const task = new AsyncTask (
		'send messages',
		() => readChannels()
		.then(channels => Promise.all(
			Object.entries (
				trace (channels).reduce((acc, {city, channelId, lastValue}) => {
					acc[city] = [...(acc[city] ?? []), {channelId, lastValue}]
					return acc
				}, {})
			).flatMap (([city, xs]) => 
				getFor (city)
					.then (data => {
						const {city: {url}} = data
						const qualData = getAirQuality (data)
						const {name} = qualData
						const [{lastValue}] = xs
						if (name !== lastValue) {
							xs.forEach (({channelId}) => bot.sendMessage (channelId, formatMessage ({...qualData, url})))
						}
						return xs.map(({channelId}) => ({city, channelId, lastValue: name}))
					})
			)
		)).then(xs => writeChannels (xs.flat())),
		console.error,
	)
	const interval = {seconds: 30}
	const job = new SimpleIntervalJob(interval, task)
	scheduler.addSimpleIntervalJob(job)

	bot.on('message', msg => {
		const channelId = msg.chat.id
		const messageText = getMessageText(msg)
		if (/enable/i.test (messageText)) {
			bot.sendMessage (channelId, `enabled. interval is ${JSON.stringify (interval)}`)
			return getFor (city)
				.then (getAirQuality)
				.then (({name}) => {
					bot.sendMessage (channelId, name)
					return {city, channelId, lastValue: name}
				})
				.then(appendToChannels)
		}
		bot.sendMessage (msg.chat.id, 'pardon?')
	})
}

const scheduler = new ToadScheduler ()
const bot = new TelegramBot(telegramToken, {polling: true})
main ({scheduler, bot})
	// .then(_ => {
	// 	scheduler.addSimpleIntervalJob(job)
	// })
