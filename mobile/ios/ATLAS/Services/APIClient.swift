import Foundation

/// Talks to the live ATLAS server. Only the text the person confirmed is sent; never a photo.
struct APIClient: Sendable {
    static let baseURL = URL(string: "https://atlas-team12.vercel.app")!

    var baseURL: URL = APIClient.baseURL
    var session: URLSession = .shared

    func extract(text: String, level: ReadingLevel, language: Language) async throws -> CarePlanResponse {
        try await post("/api/extract", body: ExtractRequest(text: text, reading_level: level, language: language))
    }

    func plan(_ request: PlanRequest) async throws -> PlanResponse {
        try await post("/api/plan", body: request)
    }

    func results(text: String, language: Language) async throws -> ResultsResponse {
        try await post("/api/results", body: ResultsRequest(text: text, language: language))
    }

    private func post<Body: Encodable, Out: Decodable>(_ path: String, body: Body) async throws -> Out {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.timeoutInterval = 90
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.httpBody = try JSONEncoder().encode(body)

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
