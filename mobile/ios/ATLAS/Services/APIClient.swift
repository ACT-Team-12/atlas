import Foundation

/// Talks to the live ATLAS server. Only the text the person confirmed is sent; never a photo.
struct APIClient: Sendable {
    static let baseURL = URL(string: "https://atlas-team12.vercel.app")!
    /// Counted as the iPhone app in the server's anonymous counts (web/src/lib/db.ts surfaceOf accepts "ios").
    static let surfaceHeader = "x-atlas-surface"
    static let surface = "ios"

    var baseURL: URL = APIClient.baseURL
    var session: URLSession = .shared

    func extract(text: String, level: ReadingLevel, language: Language) async throws -> CarePlanResponse {
        try await post("/api/extract", body: ExtractRequest(text: text, reading_level: level, language: language))
    }

    /// `fromHelperLink`: this plan was built after opening a helper link (counted once by the server, never the link).
    func plan(_ request: PlanRequest, fromHelperLink: Bool = false) async throws -> PlanResponse {
        try await post("/api/plan", body: request,
                       headers: fromHelperLink ? [HelperLink.entryHeader: HelperLink.helperEntry] : [:])
    }

    /// The second-model double-check of each explanation against its line (web/src/app/api/meaning).
    func meaning(_ request: MeaningRequest) async throws -> MeaningResponse {
        try await post("/api/meaning", body: request)
    }

    func results(text: String, language: Language) async throws -> ResultsResponse {
        try await post("/api/results", body: ResultsRequest(text: text, language: language))
    }

    /// "Ask my paper" (web/src/app/api/ask): the same body the website sends. The answer is read here; a refusal by the
    /// server comes back as its status and its x-atlas-limit header, so the screen can show fixed words in the person's
    /// language instead of the server's English. Network failures throw, as for every other call.
    func ask(sourceText: String, language: Language, question: String) async throws -> AskOutcome {
        let req = try request("/api/ask", body: AskRequest(source_text: sourceText, language: language, question: question))
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch is CancellationError {
            throw APIError.cancelled
        } catch let error as URLError {
            if error.code == .cancelled { throw APIError.cancelled }
            throw APIError.message("We could not reach ATLAS. Check your internet connection and try again.")
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.message("Something went wrong. Try again.") }
        guard (200..<300).contains(http.statusCode) else {
            return .refused(status: http.statusCode, limit: http.value(forHTTPHeaderField: "x-atlas-limit"))
        }
        guard let answer = AskPaper.decode(data) else { throw APIError.message("bad answer") }
        return .answer(answer)
    }

    /// The request as sent: JSON body, the surface header on every call, plus any extra headers.
    func request<Body: Encodable>(_ path: String, body: Body, headers: [String: String] = [:]) throws -> URLRequest {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.timeoutInterval = 90
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(Self.surface, forHTTPHeaderField: Self.surfaceHeader)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = try JSONEncoder().encode(body)
        return req
    }

    private func post<Body: Encodable, Out: Decodable>(_ path: String, body: Body, headers: [String: String] = [:]) async throws -> Out {
        let req = try request(path, body: body, headers: headers)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch is CancellationError {
            throw APIError.cancelled
        } catch let error as URLError {
            if error.code == .cancelled { throw APIError.cancelled }
            if error.code == .timedOut { throw APIError.message("This took too long. Check your connection and try again.") }
            throw APIError.message("We could not reach ATLAS. Check your internet connection and try again.")
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.message("Something went wrong. Try again.")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.from(status: http.statusCode, data: data)
        }
        do {
            return try JSONDecoder().decode(Out.self, from: data)
        } catch {
            throw APIError.message("ATLAS sent back something this app could not read. Try again.")
        }
    }
}

/// The body of POST /api/ask (AskRequestSchema in web/src/lib/ask.ts).
struct AskRequest: Encodable, Sendable {
    let source_text: String
    let language: Language
    let question: String
}

/// What /api/ask gave back: an answer to show, or a refusal (rate limit, daily cap, no AI key, bad request).
enum AskOutcome: Equatable, Sendable {
    case answer(AskPaper.Response)
    case refused(status: Int, limit: String?)
}

enum APIError: Error, Equatable, LocalizedError {
    case cancelled
    case message(String)

    var errorDescription: String? {
        switch self {
        case .cancelled: "Stopped."
        case let .message(m): m
        }
    }

    /// Plain words for a server error. 429 has its own wording; otherwise the server's own `error` text.
    static func from(status: Int, data: Data) -> APIError {
        if status == 429 { return .message("Too many tries, wait a few minutes.") }
        if let body = try? JSONDecoder().decode(APIErrorBody.self, from: data), !body.error.isEmpty {
            return .message(body.error)
        }
        if status >= 500 { return .message("ATLAS had a problem on its side. Try again in a minute.") }
        return .message("Something went wrong. Try again.")
    }
}
